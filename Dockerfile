# Example: wrap a static web app in an image deployable to kube/podman/etc.
#
# We serve the split assets (index.html + wow.mp3) rather than the single-file
# bundle: the HTML stays tiny so first paint is fast, and the mp3 is fetched
# lazily (only after first render / on first click), so it never blocks load.
#
# nginx-unprivileged runs as a non-root user on port 8080 — friendly to rootless
# podman and restrictive kube security contexts.
FROM nginxinc/nginx-unprivileged:alpine
COPY default.conf /etc/nginx/conf.d/default.conf
COPY src/ /usr/share/nginx/html/
EXPOSE 8080
