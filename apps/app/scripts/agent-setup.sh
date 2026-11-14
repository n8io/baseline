#!/usr/bin/env bash
# Readies a fresh cloud machine for an agent working on this app: Node from .node-version through nvm, the
# pnpm in packageManager, dependencies, and a running Docker daemon that pulls through a mirror.
# Safe to run again: each step skips what is already done. Read docs/agents/agent-setup.md.
#
#   bash scripts/agent-setup.sh
#
# A script cannot change its caller's shell, so every later shell call that runs node or pnpm
# starts with: source "$NVM_DIR/nvm.sh" && nvm use <version> >/dev/null
set -euo pipefail

cd "$(dirname "$0")/.."
node_version="$(tr -d '[:space:]' <.node-version)"
nvm_dir="${NVM_DIR:-/opt/nvm}"
mirror="https://mirror.gcr.io"

step() { printf '\n== %s\n' "$1"; }

step "Node ${node_version}"
if [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)" != "${node_version}" ]; then
	if [ ! -s "${nvm_dir}/nvm.sh" ]; then
		echo "Node ${node_version} is not on PATH and nvm is not at ${nvm_dir}. Install Node ${node_version}, then run this again." >&2
		exit 1
	fi
	# nvm reads unset variables, so strict mode pauses around it.
	set +u
	# shellcheck source=/dev/null
	source "${nvm_dir}/nvm.sh" --no-use
	if ! nvm install "${node_version}" >/tmp/agent-setup-nvm.log 2>&1; then
		cat /tmp/agent-setup-nvm.log >&2
		echo "nvm install ${node_version} failed (above)." >&2
		exit 1
	fi
	nvm use "${node_version}" >/dev/null
	set -u
fi
echo "node $(node -v)"

step "pnpm"
pnpm_version="$(node -p 'require("./package.json").packageManager.split("@")[1].split("+")[0]')"
if [ "$(pnpm -v 2>/dev/null)" != "${pnpm_version}" ]; then
	npm install --global --loglevel=error "pnpm@${pnpm_version}"
fi
echo "pnpm $(pnpm -v)"

step "Dependencies"
pnpm install --frozen-lockfile
echo "installed"

step "Docker"
if ! command -v dockerd >/dev/null; then
	echo "No Docker here: unit tests and pnpm check work; integration tests and pnpm dev need Docker."
elif docker info >/dev/null 2>&1; then
	echo "dockerd is running"
	if ! grep -qs registry-mirrors /etc/docker/daemon.json; then
		echo "It pulls without a registry mirror; if Docker Hub answers 429, read docs/agents/agent-setup.md."
	fi
elif [ "$(id -u)" != "0" ]; then
	echo "dockerd is not running, and starting it needs root. Start Docker, then run this again." >&2
	exit 1
else
	if [ ! -f /etc/docker/daemon.json ]; then
		# Docker Hub rate-limits shared cloud addresses; the mirror also serves digest-pinned images.
		mkdir -p /etc/docker
		printf '{"registry-mirrors":["%s"]}\n' "${mirror}" >/etc/docker/daemon.json
		echo "wrote /etc/docker/daemon.json (registry mirror ${mirror})"
	elif ! grep -q registry-mirrors /etc/docker/daemon.json; then
		echo "/etc/docker/daemon.json has no registry-mirrors, so Docker Hub may answer 429; read docs/agents/agent-setup.md."
	fi
	nohup dockerd >/tmp/dockerd.log 2>&1 &
	for _ in $(seq 1 30); do
		docker info >/dev/null 2>&1 && break
		sleep 1
	done
	if docker info >/dev/null 2>&1; then
		echo "dockerd is running"
	else
		echo "dockerd did not start; read /tmp/dockerd.log" >&2
		exit 1
	fi
fi

step "oasdiff"
if command -v oasdiff >/dev/null; then
	echo "oasdiff $(oasdiff --version 2>/dev/null | head -n 1)"
else
	echo "Not installed: pnpm api-check prints its install line. Where the download is blocked, CI's oasdiff job runs the check."
fi

step "Ready"
echo "Start each shell call that runs node or pnpm with:"
echo "  source ${nvm_dir}/nvm.sh && nvm use ${node_version} >/dev/null"
