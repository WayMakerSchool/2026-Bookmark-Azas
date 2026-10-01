#!/usr/bin/env python3
"""Upload ESP32-S3 firmware in quiet, restartable pieces."""

import argparse
import glob
import subprocess
import sys
import tempfile
import time
from pathlib import Path


# Native USB CDC is more stable when the ROM loader receives small,
# uncompressed writes. Larger compressed blocks can reset mid-packet.
CHUNK_SIZE = 16 * 1024
MAX_PIECE_ATTEMPTS = 3
PORT_WAIT_SECONDS = 12
COMMAND_TIMEOUT_SECONDS = 75
BOOTLOADER_PROBE_TIMEOUT_SECONDS = 12


def required_file(path, description):
    if not path.is_file():
        raise FileNotFoundError(f"Missing {description}: {path}")
    return path


def existing_port(preferred):
    if preferred and "usbmodem" in preferred and Path(preferred).exists():
        return preferred
    candidates = sorted(glob.glob("/dev/cu.usbmodem*"))
    return candidates[0] if candidates else None


def wait_for_port(preferred):
    deadline = time.monotonic() + PORT_WAIT_SECONDS
    while time.monotonic() < deadline:
        port = existing_port(preferred)
        if port:
            return port
        time.sleep(0.4)
    raise RuntimeError("ESP32 USB port did not appear within 12 seconds")


def run_quiet(command, timeout):
    try:
        completed = subprocess.run(
            command,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=timeout,
        )
        return completed.returncode, completed.stdout
    except subprocess.TimeoutExpired as error:
        output = error.stdout or ""
        if isinstance(output, bytes):
            output = output.decode(errors="replace")
        return 124, output


def probe_bootloader(esptool, port, before):
    command = [
        sys.executable,
        str(esptool),
        "--chip", "esp32s3",
        "--no-stub",
        "--port", port,
        "--baud", "115200",
        "--before", before,
        "--after", "no_reset",
        "--connect-attempts", "3",
        "chip_id",
    ]
    return run_quiet(command, BOOTLOADER_PROBE_TIMEOUT_SECONDS)[0] == 0


def enter_bootloader(esptool, preferred_port):
    # Core 2.0.16 HW CDC can vanish while DTR/RTS is toggled. Reopening the
    # same USB path after it reappears lets esptool continue in ROM mode.
    for _ in range(3):
        port = wait_for_port(preferred_port)
        if probe_bootloader(esptool, port, "no_reset"):
            return port
        if probe_bootloader(esptool, port, "usb_reset"):
            return port
        time.sleep(1.5)

    raise RuntimeError(
        "Could not enter ESP32-S3 download mode. Hold BOOT, tap RESET, "
        "release BOOT, then upload again."
    )


def flash_piece(esptool, preferred_port, offset, image, label, final=False):
    last_output = ""
    for attempt in range(1, MAX_PIECE_ATTEMPTS + 1):
        if attempt == 1:
            port = wait_for_port(preferred_port)
        else:
            print(f"  {label}: reconnecting ({attempt}/{MAX_PIECE_ATTEMPTS})", flush=True)
            time.sleep(1.5)
            port = enter_bootloader(esptool, preferred_port)

        command = [
            sys.executable,
            str(esptool),
            "--chip", "esp32s3",
            "--no-stub",
            "--port", port,
            "--baud", "115200",
            "--before", "no_reset",
            "--after", "hard_reset" if final else "no_reset",
            "--connect-attempts", "3",
            "write_flash", "-u",
            "--flash_mode", "keep",
            "--flash_freq", "keep",
            "--flash_size", "keep",
            hex(offset),
            str(image),
        ]
        result, last_output = run_quiet(command, COMMAND_TIMEOUT_SECONDS)
        if result == 0:
            return port

    details = "\n".join(last_output.strip().splitlines()[-12:])
    raise RuntimeError(f"Failed while writing {label}.\n{details}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", required=True)
    parser.add_argument("--firmware", required=True)
    parser.add_argument("--start-piece", type=int, default=0)
    args = parser.parse_args()

    firmware = required_file(Path(args.firmware).resolve(), "firmware")
    build_dir = firmware.parent
    packages_dir = Path.home() / ".platformio" / "packages"
    esptool = required_file(packages_dir / "tool-esptoolpy" / "esptool.py", "esptool")
    boot_app = required_file(
        packages_dir / "framework-arduinoespressif32" / "tools" / "partitions" / "boot_app0.bin",
        "boot_app0",
    )
    fixed_images = [
        ("bootloader", 0x0000, required_file(build_dir / "bootloader.bin", "bootloader")),
        ("partitions", 0x8000, required_file(build_dir / "partitions.bin", "partitions")),
        ("boot app", 0xE000, boot_app),
    ]

    firmware_data = firmware.read_bytes()
    chunk_count = (len(firmware_data) + CHUNK_SIZE - 1) // CHUNK_SIZE
    start_piece = max(0, min(args.start_piece, chunk_count - 1))
    print(
        f"Bookmark upload: 3 setup images + {chunk_count} firmware pieces. "
        "Each piece is retried at most 3 times.",
        flush=True,
    )

    port = enter_bootloader(esptool, args.port)
    if start_piece == 0:
        for label, offset, image in fixed_images:
            print(f"[setup] {label}", flush=True)
            port = flash_piece(esptool, port, offset, image, label)
    else:
        print(f"Resuming firmware at piece {start_piece + 1}/{chunk_count}.", flush=True)

    with tempfile.TemporaryDirectory(prefix="bookmark-upload-") as temp_dir:
        for index in range(start_piece, chunk_count):
            start = index * CHUNK_SIZE
            chunk = firmware_data[start:start + CHUNK_SIZE]
            chunk_path = Path(temp_dir) / f"firmware-{index:02d}.bin"
            chunk_path.write_bytes(chunk)
            percent = ((index + 1) * 100) // chunk_count
            label = f"firmware {index + 1}/{chunk_count}"
            print(f"[{label}] {percent}%", flush=True)
            port = flash_piece(
                esptool,
                port,
                0x10000 + start,
                chunk_path,
                label,
                final=index == chunk_count - 1,
            )

    print("Bookmark firmware upload completed successfully.", flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"\nUpload failed: {error}", file=sys.stderr, flush=True)
        sys.exit(1)
