#!/usr/bin/env python3
"""Import the verified 228-file ApertureCAD 2.5.0 release without rewriting bytes.

Usage: python tools/import-release.py /path/to/aperture-cad-v2.5.0.zip --target .
The archive must be the original release, not a ZIP regenerated after a build.
No Git, network, credential, or branch operations are performed by this script.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys
import tempfile
import zipfile

ARCHIVE_SHA256 = "7d2d7c0f9509bff78f20d41d5c805dacad10e5b632219c0f8a1a18782fbd2490"
PREFIX = "aperture-cad-v2.5.0/"
FILE_COUNT = 228
MAX_ARCHIVE_BYTES = 16 * 1024 * 1024
MAX_CONTENT_BYTES = 64 * 1024 * 1024


def unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"Duplicate manifest key: {key}")
        result[key] = value
    return result


def read_release(archive: Path) -> dict[str, bytes]:
    if archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("Archive exceeds the release size limit")
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest != ARCHIVE_SHA256:
        raise ValueError(f"Archive SHA-256 mismatch: {digest}")
    files: dict[str, bytes] = {}
    folded: set[str] = set()
    with zipfile.ZipFile(archive) as z:
        members = [entry for entry in z.infolist() if not entry.is_dir()]
        if len(members) != FILE_COUNT:
            raise ValueError(f"Expected {FILE_COUNT} files, found {len(members)}")
        if sum(entry.file_size for entry in members) > MAX_CONTENT_BYTES:
            raise ValueError("Expanded archive exceeds the release size limit")
        for entry in members:
            name = entry.filename
            if not name.startswith(PREFIX):
                raise ValueError(f"Unexpected archive root: {name}")
            relative = name[len(PREFIX):]
            parts = relative.split("/")
            if (not relative or "\\" in relative or "\0" in relative
                    or any(part in {"", ".", "..", ".git"} for part in parts)
                    or PurePosixPath(relative).is_absolute()):
                raise ValueError(f"Unsafe archive path: {name}")
            if relative.casefold() in folded:
                raise ValueError(f"Duplicate or case-colliding path: {name}")
            folded.add(relative.casefold())
            mode = (entry.external_attr >> 16) & 0xFFFF
            if stat.S_IFMT(mode) not in {0, stat.S_IFREG}:
                raise ValueError(f"Non-regular archive entry: {name}")
            files[relative] = z.read(entry)
    manifest = json.loads(files["SHA256SUMS.json"], object_pairs_hook=unique_object)
    if not isinstance(manifest, dict) or set(manifest) != set(files) - {"SHA256SUMS.json"}:
        raise ValueError("Manifest does not cover exactly the other 227 release files")
    for name, expected in manifest.items():
        if not isinstance(expected, str) or hashlib.sha256(files[name]).hexdigest() != expected:
            raise ValueError(f"Release file checksum mismatch: {name}")
    return files


def import_release(files: dict[str, bytes], target: Path, workflows_preseeded: bool) -> None:
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    destinations: dict[str, Path] = {}
    # Check every destination and all workflow restrictions BEFORE writing anything.
    for name, data in files.items():
        destination = target.joinpath(*PurePosixPath(name).parts)
        if not destination.resolve().is_relative_to(target):
            raise ValueError(f"Destination escapes repository: {name}")
        current = destination
        while current != target:
            if current.is_symlink():
                raise ValueError(f"Refusing symbolic-link destination: {name}")
            current = current.parent
        if destination.exists() and not destination.is_file():
            raise ValueError(f"Destination is not a regular file: {name}")
        if workflows_preseeded and name.startswith(".github/workflows/"):
            if not destination.is_file() or destination.read_bytes() != data:
                raise ValueError(f"Precommit the original workflow through an authorized GitHub client: {name}")
        destinations[name] = destination
    for name, data in files.items():
        destination = destinations[name]
        if destination.is_file() and destination.read_bytes() == data:
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary = tempfile.mkstemp(prefix=".release-", dir=destination.parent)
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(data)
            os.chmod(temporary, 0o644)
            os.replace(temporary, destination)
        finally:
            Path(temporary).unlink(missing_ok=True)
    for name, data in files.items():
        if destinations[name].read_bytes() != data:
            raise ValueError(f"Post-import byte verification failed: {name}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--target", type=Path, default=Path.cwd())
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--workflows-preseeded", action="store_true",
                        help="Do not create or modify workflow files with GITHUB_TOKEN")
    args = parser.parse_args()
    try:
        files = read_release(args.archive)
        if not args.verify_only:
            import_release(files, args.target, args.workflows_preseeded)
        print(f"{'Verified' if args.verify_only else 'Imported and verified'} all {len(files)} release files.")
        print(f"Archive SHA-256: {ARCHIVE_SHA256}")
        return 0
    except (OSError, ValueError, KeyError, zipfile.BadZipFile) as error:
        print(f"Release import failed: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
