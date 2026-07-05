const BRACKETED_MEDIA_PLACEHOLDER_RE = /^\[.+\]$/;
const GENERATED_PHOTO_CAPTION_RE = /^(?:📷|📸)?\s*Фото(?:\s+\d+\s*\/\s*\d+)?$/iu;

export function isGeneratedMediaCaption(content: string | null | undefined): boolean {
  const c = content?.trim();
  return !!c && (
    BRACKETED_MEDIA_PLACEHOLDER_RE.test(c)
    || GENERATED_PHOTO_CAPTION_RE.test(c)
  );
}

export function hasRealMediaCaption(content: string | null | undefined): boolean {
  const c = content?.trim();
  return !!c && !isGeneratedMediaCaption(c);
}
