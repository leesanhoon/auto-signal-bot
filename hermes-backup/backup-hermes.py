#!/usr/bin/env python3
"""
Hermes Multi-Agent Backup Script
Packages: lead + worker profiles, AGENTS.md, task queue, bash aliases
Usage:   python backup-hermes.py
Output:  hermes-multiagent-backup.tar.gz
"""

import tarfile
import os
import shutil
from datetime import datetime

HOME = os.path.expanduser("~")
HERMES_HOME = os.path.join(HOME, "AppData", "Local", "hermes")
PROJECT = "H:/LeeSanHoon/auto-signal-bot"
BACKUP_DIR = os.path.join(PROJECT, "hermes-backup")
TIMESTAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
OUTPUT = os.path.join(BACKUP_DIR, f"hermes-multiagent-full-{TIMESTAMP}.tar.gz")

os.makedirs(BACKUP_DIR, exist_ok=True)

def add_file(tar, src, arcname):
    if os.path.exists(src):
        tar.add(src, arcname=arcname)
        print(f"  ✓ {arcname}")

with tarfile.open(OUTPUT, "w:gz") as tar:
    print("Exporting Hermes profiles...")
    # 1. Export profiles via hermes CLI (cleaner - includes .env, memories, sessions)
    for profile in ["lead", "worker"]:
        export_path = os.path.join(BACKUP_DIR, f"{profile}.tar.gz")
        # Remove old export first
        if os.path.exists(export_path):
            os.remove(export_path)
        os.system(f'hermes profile export {profile} -o "{export_path}"')
        if os.path.exists(export_path):
            tar.add(export_path, arcname=f"profiles/{profile}.tar.gz")
            print(f"  ✓ profiles/{profile}.tar.gz")
    
    print("\nExporting project config...")
    # 2. Project-level AGENTS.md
    add_file(tar, os.path.join(PROJECT, "AGENTS.md"), "project/AGENTS.md")
    
    # 3. Tasks directory structure (without generated files)
    tasks_dir = os.path.join(PROJECT, "tasks")
    if os.path.exists(tasks_dir):
        for root, dirs, files in os.walk(tasks_dir):
            for f in files:
                src = os.path.join(root, f)
                arc = os.path.relpath(src, PROJECT)
                # Skip generated files
                if f in ("result.md", "review.md", "done.md", "blocked.md"):
                    continue
                tar.add(src, arcname=f"project/{arc}")
    
    # 4. Shell aliases
    bash_aliases = os.path.join(HOME, ".bash_aliases")
    add_file(tar, bash_aliases, "shell/.bash_aliases")
    
    # 5. Backup script itself
    add_file(tar, __file__, "backup-hermes.py")

print(f"\n✅ Backup created: {OUTPUT}")
print(f"   Size: {os.path.getsize(OUTPUT) / 1024:.0f} KB")
print()
print("📋 Contains:")
print("  - profiles/lead.tar.gz     (config + skills + memories + .env + sessions)")
print("  - profiles/worker.tar.gz   (config + skills + memories + .env + sessions)")
print("  - project/AGENTS.md        (task queue protocol)")
print("  - project/tasks/           (task structure + examples)")
print("  - shell/.bash_aliases      (lead/worker aliases)")
print("  - backup-hermes.py         (this script)")
