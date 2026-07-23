export function detectSentenceBoundary(text: string): number {
  const m = text.search(/[.!?。！？।؟\u104A\u104B](?:\s|$)/);
  if (m >= 0) return m + 1;
  if (text.length > 60) {
    const clauseRe = /[,;:、，；：،؛]\s?|\n/g;
    let last = -1;
    let match;
    while ((match = clauseRe.exec(text)) !== null) {
      last = match.index + match[0].length;
    }
    if (last > 20) return last;
  }
  if (text.length > 120) {
    const sp = text.lastIndexOf(' ', 120);
    return sp > 20 ? sp + 1 : 120;
  }
  return -1;
}
