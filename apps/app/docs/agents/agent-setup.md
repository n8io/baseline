# Setting up a cloud machine for an agent

Read when you work on a fresh cloud machine (a Claude Code cloud machine, a CI-like sandbox) rather than on a laptop with `fnm` and Docker Desktop. Such a machine has an older Node on `PATH`, no running Docker daemon, a shared address that Docker Hub rate-limits, and often a TLS-terminating proxy.

## Run the script

```sh
bash scripts/agent-setup.sh
```

It is safe to run again, and takes about 20 s on a fresh machine. It:

1. Installs the Node in `.node-version` through nvm (`$NVM_DIR`, default `/opt/nvm`) when `node` is another version.
2. Installs the pnpm version in `packageManager` when `pnpm` is another one.
3. Runs `pnpm install --frozen-lockfile`.
4. When Docker is not running (and the script runs as root): writes `{"registry-mirrors":["https://mirror.gcr.io"]}` to `/etc/docker/daemon.json` when the file is missing, starts `dockerd` (log in `/tmp/dockerd.log`) and waits until it answers.
5. Says whether `oasdiff` is on `PATH`.

No SessionStart hook runs it: the Template stays agent-neutral. Add it to your cloud environment's setup script if you want it on every machine.

## In every later shell call

A script cannot change its caller's shell, and each tool call starts a fresh shell on the old Node. Start every command that runs node or pnpm with:

```sh
source /opt/nvm/nvm.sh && nvm use 26 >/dev/null && pnpm check
```

Without it a script stops with "needs Node 26" (`scripts/node-version-require.ts`).

## When something stops working

- **Docker is gone.** The daemon can die between turns. `docker info` fails: run the script again; it starts `dockerd`, and its other steps skip what is done.
- **429 Too Many Requests on a pull.** The daemon runs without the mirror: `/etc/docker/daemon.json` existed without `registry-mirrors` (the script leaves it alone), or the daemon was already running when the script wrote the file. Add the mirror if it is missing and restart `dockerd`. The mirror serves plain names and digest-pinned bases. When you cannot edit the daemon's config, set `IMAGE_REGISTRY=mirror.gcr.io/library/` in `.env.development.local`: `compose.yaml` puts it in front of the Postgres and Redis images.
- **`pnpm api-check` says oasdiff is missing.** It prints the install line. Where the download is blocked, CI's `oasdiff` job runs the check on your pull request.

## Building the production image behind a TLS proxy

`docker build` fails on `npm install` and `pnpm fetch` when a proxy re-signs TLS, because the image does not trust the proxy's CA. Build from a throwaway copy of the Dockerfile that trusts it, outside the repo, so the CA is never committed:

```sh
mkdir -p /tmp/proxy-build && cp "$NODE_EXTRA_CA_CERTS" /tmp/proxy-build/ca.crt
sed '/^FROM .* AS build$/a COPY --from=proxy-ca ca.crt /usr/local/share/proxy-ca.crt\nENV NODE_EXTRA_CA_CERTS=/usr/local/share/proxy-ca.crt npm_config_cafile=/usr/local/share/proxy-ca.crt' Dockerfile > /tmp/proxy-build/Dockerfile
docker build --network host --build-context proxy-ca=/tmp/proxy-build -f /tmp/proxy-build/Dockerfile .
```

`$NODE_EXTRA_CA_CERTS` names the proxy's CA bundle on a Claude Code cloud machine; elsewhere use the file your proxy documents. CI's `image` job builds the real Dockerfile, so you rarely need this.
