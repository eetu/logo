# Example: wrap a static web app in an image deployable to kube/podman/etc.
#
# Build the single-file bundle with Vite (via the vendored yarn binary — no
# corepack), then serve dist/ with nginx. The HTML has the JS/CSS/audio inlined;
# favicons + the web manifest sit beside it.
#
# nginx-unprivileged runs as a non-root user on port 8080 — friendly to rootless
# podman and restrictive kube security contexts.
FROM node:26-alpine AS build
WORKDIR /app
COPY .yarnrc.yml package.json yarn.lock ./
COPY .yarn/ .yarn/
RUN node .yarn/releases/yarn-*.cjs install --immutable
COPY . .
RUN node .yarn/releases/yarn-*.cjs build

FROM nginxinc/nginx-unprivileged:alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
