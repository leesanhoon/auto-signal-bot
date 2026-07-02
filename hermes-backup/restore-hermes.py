#!/usr/bin/env python3
"""
Hermes Multi-Agent Restore Script
Usage:   python restore-hermes.py <backup.tar.gz>
"""

import tarfile
import sys
import os
import subprocess

HOME = os.path.expanduser("~")
HERMES_HOME = os.path.join(HOME, "AppData", "Local", "hermes")

def main():
    if len(sys.argv) < 2:
        print("Usage: python restore-hermes.py <backup.tar.gz>")
        print("Example: python restore-hermes.py hermes-multiagent-full-20260702_110000.tar.gz")
        sys.exit(1)
    
    backup = sys.argv[1]
    if not os.path.exists(backup):
        print(f"❌ File not found: {backup}")
        sys.exit(1)
    
    # Extract
    extract_dir = os.path.join(HOME, ".hermes-restore-tmp")
    if os.path.exists(extract_dir):
        shutil.rmtree(extract_dir)
    
    with tarfile.open(backup, "r:gz") as tar:
        tar.extractall(extract_dir)
    
    print("=== Hermes Multi-Agent Restore ===\n")
    
    # 1. Restore profiles
    profiles_dir = os.path.join(extract_dir, "profiles")
    if os.path.exists(profiles_dir):
        for f in os.listdir(profiles_dir):
            if f.endswith(".tar.gz"):
                name = f.replace(".tar.gz", "")
                print(f"Restoring profile: {name}...")
                result = subprocess.run(
                    ["hermes", "profile", "import", os.path.join(profiles_dir, f)],
                    capture_output=True, text=True
                )
                print(f"  → {result.stdout.strip() or result.stderr.strip()}")
                if result.returncode != 0:
                    # If import fails, try with --force
                    result = subprocess.run(
                        ["hermes", "profile", "import", "--force", os.path.join(profiles_dir, f)],
                        capture_output=True, text=True
                    )
                    print(f"  → (retry with --force) {result.stdout.strip() or result.stderr.strip()}")
    
    # 2. Restore project config
    project_dir = os.path.join(extract_dir, "project")
    if os.path.exists(project_dir):
        print("\nRestoring project files (AGENTS.md, tasks/)...")
        # Copy AGENTS.md and tasks/ to current directory
        for item in os.listdir(project_dir):
            src = os.path.join(project_dir, item)
            dst = os.path.join(os.getcwd(), item)
            if os.path.isdir(src):
                if os.path.exists(dst):
                    # Only restore .examples and README
                    for sub in os.listdir(src):
                        if sub in (".examples", "README.md", ".gitignore"):
                            sub_src = os.path.join(src, sub)
                            sub_dst = os.path.join(dst, sub)
                            if os.path.isdir(sub_src):
                                import shutil
                                shutil.copytree(sub_src, sub_dst, dirs_exist_ok=True)
                            else:
                                import shutil
                                shutil.copy2(sub_src, sub_dst)
                else:
                    import shutil
                    shutil.copytree(src, dst)
            else:
                import shutil
                shutil.copy2(src, dst)
            print(f"  ✓ {item}")
    
    # 3. Restore shell aliases
    shell_dir = os.path.join(extract_dir, "shell")
    if os.path.exists(shell_dir):
        print("\nRestoring shell aliases...")
        for f in os.listdir(shell_dir):
            src = os.path.join(shell_dir, f)
            dst = os.path.join(HOME, f)
            import shutil
            shutil.copy2(src, dst)
            print(f"  ✓ ~/{f}")
        print("  → Run: source ~/.bashrc")
    
    # Cleanup
    import shutil
    shutil.rmtree(extract_dir)
    
    print("\n✅ Restore complete!")
    print("Run 'hermes profile list' to verify profiles are loaded.")
    print("Then 'hermes --profile lead -s claude-code' to start working.")

if __name__ == "__main__":
    main()
