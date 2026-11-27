#!/usr/bin/env python3
"""Install the approved LHRLAB/HyperGraphRAG commit into an isolated venv.

This script never installs globally and never downloads model weights. The caller
must provide an absolute Python executable and an approved wheelhouse. Source is
copied only after its git tree hash matches runtime-source.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import venv
from pathlib import Path

COMMIT = "e01d2f2a5f3d1e80415b933c10fa7d14587cf811"
REPOSITORY = "https://github.com/LHRLAB/HyperGraphRAG.git"


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def git_tree_hash(source: Path) -> str:
    result = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD^{tree}"], check=True, capture_output=True, text=True)
    return result.stdout.strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--python", required=True)
    parser.add_argument("--source", required=True, help="approved local git checkout")
    parser.add_argument("--venv", required=True)
    parser.add_argument("--wheelhouse", required=True)
    parser.add_argument("--requirements", required=True)
    parser.add_argument("--runtime-source", required=True)
    args = parser.parse_args()
    python = Path(args.python).resolve()
    source = Path(args.source).resolve()
    target = Path(args.venv).resolve()
    wheelhouse = Path(args.wheelhouse).resolve()
    requirements = Path(args.requirements).resolve()
    metadata_path = Path(args.runtime_source).resolve()
    if not python.is_file() or not source.is_dir() or not wheelhouse.is_dir() or not requirements.is_file():
        raise SystemExit("absolute python/source/wheelhouse/requirements are required")
    head = subprocess.run(["git", "-C", str(source), "rev-parse", "HEAD"], check=True, capture_output=True, text=True).stdout.strip()
    if head != COMMIT:
        raise SystemExit(f"source commit mismatch: {head}")
    tree = git_tree_hash(source)
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    expected_tree = metadata.get("sourceTreeSha256")
    if expected_tree and expected_tree != tree:
        raise SystemExit("source tree hash mismatch")
    venv.EnvBuilder(with_pip=True, clear=False).create(target)
    venv_python = target / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
    lock = hashlib.sha256(requirements.read_bytes()).hexdigest()
    if metadata.get("dependencyLockSha256") and metadata["dependencyLockSha256"] != lock:
        raise SystemExit("dependency lock hash mismatch")
    subprocess.run([str(venv_python), "-I", "-m", "pip", "install", "--no-index", "--find-links", str(wheelhouse), "--require-hashes", "-r", str(requirements)], check=True)
    # The official repository has no pyproject/setup.py. Build a minimal wheel in a
    # temporary directory, preserving direct_url commit provenance via a local VCS
    # install is not supported without packaging metadata; record source tree hash
    # and verify imported files byte-for-byte instead.
    with tempfile.TemporaryDirectory(prefix="openstory-hypergraph-install-") as temp:
        temp_path = Path(temp)
        package = temp_path / "hypergraphrag"
        package.mkdir()
        for item in (source / "hypergraphrag").rglob("*.py"):
            rel = item.relative_to(source / "hypergraphrag")
            destination = package / rel
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(item.read_bytes())
        site = subprocess.run([str(venv_python), "-I", "-c", "import sysconfig; print(sysconfig.get_paths()['purelib'])"], check=True, capture_output=True, text=True).stdout.strip()
        installed = Path(site) / "hypergraphrag"
        subprocess.run([str(venv_python), "-I", "-c", f"import shutil; shutil.copytree({str(package)!r}, {str(installed)!r})"], check=True)
        dist_info = Path(site) / "openstory_hypergraphrag-runtime.dist-info"
        dist_info.mkdir(exist_ok=True)
        (dist_info / "METADATA").write_text("Metadata-Version: 2.1\nName: openstory-hypergraphrag-runtime\nVersion: 0.0.0\n", encoding="utf-8")
        (dist_info / "direct_url.json").write_text(json.dumps({"url": REPOSITORY, "vcs_info": {"vcs": "git", "commit_id": COMMIT}}), encoding="utf-8")
        (dist_info / "openstory-runtime.json").write_text(json.dumps({"commit": COMMIT, "sourceTreeSha256": tree, "dependencyLockSha256": lock}), encoding="utf-8")
    metadata.update({"distribution": "openstory-hypergraphrag-runtime", "dependencyLockSha256": lock, "sourceTreeSha256": tree, "verifiedAt": None})
    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"ok": True, "python": str(venv_python), "commit": COMMIT, "tree": tree, "lock": lock}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
