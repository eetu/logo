# Example: wrap a static web app in an image deployable to kube/podman/etc.
#
# We serve the split assets (index.html + wow.mp3) rather than the single-file
# bundle: the HTML stays tiny so first paint is fast, and the mp3 is fetched
# lazily (only after first render / on first click), so it never blocks load.
#
# nginx-unprivileged runs as a non-root user on port 8080 — friendly to rootless
# podman and restrictive kube security contexts.
FROM nginxinc/nginx-unprivileged:alpine
COPY index.html wow.mp3 favicon.svg favicon.ico favicon-16.png favicon-32.png \
  apple-touch-icon.png icon-192.png icon-512.png site.webmanifest \
  /usr/share/nginx/html/
EXPOSE 8080
