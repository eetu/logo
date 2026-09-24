#!/bin/sh
# Optional Liwan analytics (https://liwan.dev). Set LIWAN_SCRIPT_URL and
# LIWAN_ENTITY and nginx injects the tracker before </head> of every HTML
# response. Leave both unset and the page is served untouched — the image stays
# a plain static site for anyone else who runs it.
#
# Runs from the nginx image's /docker-entrypoint.d/ on every container start.
set -eu

url="${LIWAN_SCRIPT_URL:-}"
entity="${LIWAN_ENTITY:-}"
conf=/etc/nginx/conf.d/liwan.conf

rm -f "$conf"
[ -z "$url$entity" ] && exit 0

# A bad value disables tracking and says so; it never stops nginx. The page
# matters more than counting its visitors.
fail() {
  echo "40-liwan-tracker: $1 — tracking disabled" >&2
  exit 0
}

# Half a configuration is a typo, not a choice.
[ -n "$url" ] && [ -n "$entity" ] || fail "set both LIWAN_SCRIPT_URL and LIWAN_ENTITY, or neither"

# Both values end up inside an HTML attribute inside an nginx string, so allow
# only what a URL and an entity id need.
case "$url" in
  https://*) ;;
  *) fail "LIWAN_SCRIPT_URL must be an https:// URL" ;;
esac
if printf '%s' "$url$entity" | grep -q "[\"'<>[:space:];{}\\\\]"; then
  fail "LIWAN_SCRIPT_URL or LIWAN_ENTITY contains a character that is not allowed"
fi

cat >"$conf" <<EOF
sub_filter '</head>' '<script type="module" src="$url" data-entity="$entity"></script></head>';
sub_filter_once on;
EOF
echo "40-liwan-tracker: tracking with entity $entity via $url"
