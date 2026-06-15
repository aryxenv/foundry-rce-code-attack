export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function escapeAttr(value) {
  return escapeXml(value).replaceAll('"', "&quot;");
}

export function xmlDeclaration() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
}

