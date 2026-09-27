import Parser from "rss-parser";

// 自分のボードの RSS（https://www.pinterest.com/<ユーザー名>/<ボード名>.rss）
const RSS_URL = "https://www.pinterest.com/USERNAME/BOARD.rss";
// 投稿文の最大文字数（URL は X 側で 23 文字扱いなので余裕を持たせる）
const MAX_TEXT = 200;
// 通知済みとして覚えておく Pin の数（RSS は最新 25 件程度なので十分な余裕）
const SEEN_LIMIT = 300;
// 画像つき共有ページ（GitHub Pages）
const SHARE_PAGE = "https://shntrisdr.github.io/Board-to-X-Sync/share.html";

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

export default defineComponent({
  props: {
    db: { type: "data_store", label: "State store", description: "通知済みの Pin URL を保存" },
  },
  async run({ steps, $ }) {
    const parser = new Parser({ headers: { "User-Agent": "Mozilla/5.0" } });
    // 漢字・ハングル入りの URL もそのまま書けるようにエンコード（%xx はそのまま）
    const feed = await parser.parseURL(new URL(RSS_URL).href);

    // RSS の並び順（先頭が最新）のまま使う。日時は Pin 作成日の可能性があり当てにしない
    const items = feed.items
      .map((it) => ({
        title: (it.title || "").trim(),
        link: it.link,
        image: it.content?.match(/<img src="([^"]+)"/)?.[1],
      }))
      .filter((it) => it.link);

    if (!this.db) throw new Error("State store が未選択です（ステップ上部の State store 欄で Data Store を選択/作成）");

    // まだ通知していない Pin を新着とみなす。初回は先頭 1 件だけ試しに通知する
    const seen = await this.db.get("seenPins");
    const seenSet = new Set(seen ?? []);
    const fresh = seen == null ? items.slice(0, 1) : items.filter((it) => !seenSet.has(it.link));

    // 今回 RSS に載っている Pin を全部通知済みにする（新しい順に先頭へ）
    const updated = [...new Set([...items.map((it) => it.link), ...(seen ?? [])])].slice(0, SEEN_LIMIT);
    if (!fresh.length) {
      await this.db.set("seenPins", updated);
      $.export("$summary", "No new Pins");
      return;
    }

    // 古い順に並べてメールに載せる
    fresh.reverse();

    const cards = fresh.map((it) => {
      const text = it.title.length > MAX_TEXT ? it.title.slice(0, MAX_TEXT - 1) + "…" : it.title;
      const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(it.link)}`;
      const share = it.image
        ? `${SHARE_PAGE}?${new URLSearchParams({ img: it.image, text, url: it.link })}`
        : null;
      return { ...it, text, intent, share };
    });

    const html = cards.map((c) => `
      <div style="margin-bottom:24px">
        ${c.image ? `<img src="${esc(c.image)}" width="180" style="display:block;margin-bottom:8px">` : ""}
        <p>${esc(c.text) || "(no title)"}</p>
        <p>
          ${c.share ? `<a href="${esc(c.share)}"><b>画像つきで投稿（スマホ）</b></a> ・ ` : ""}
          <a href="${esc(c.intent)}">画像なしで投稿</a> ・ <a href="${esc(c.link)}">Pin を見る</a>
        </p>
      </div>`).join("");

    $.send.email({
      subject: `Board-to-X Sync: 新しい Pin ${cards.length} 件`,
      html,
      text: cards.map((c) => [
        c.text,
        c.share && `画像つきで投稿: ${c.share}`,
        `画像なしで投稿: ${c.intent}`,
      ].filter(Boolean).join("\n")).join("\n\n"),
    });

    await this.db.set("seenPins", updated);
    $.export("$summary", `Notified ${cards.length} Pin(s)`);
    return cards.map(({ link, intent, share }) => ({ link, intent, share }));
  },
});
