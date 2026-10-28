import Parser from "rss-parser";

// 自分のボードの RSS（https://www.pinterest.com/<ユーザー名>/<ボード名>.rss）
const RSS_URL = "https://www.pinterest.com/USERNAME/BOARD.rss";
// 投稿文の最大文字数（URL は X 側で 23 文字扱いなので余裕を持たせる）
const MAX_TEXT = 200;
// 通知済みとして覚えておく Pin の数（RSS に載る Pin の顔ぶれが入れ替わることがあるので多めに）
const SEEN_LIMIT = 3000;
// これより前に保存された Pin は新着にしない（RSS に昔の Pin がまとめて出てくることがあるため）。
// 保存してから RSS に載るまで数週間かかることがあるので余裕を持たせる
const MAX_AGE_DAYS = 90;
// 1 回の実行で RSS を取得する回数。取得のたびに中身の違う RSS が返ってくるので、何回か取って合わせる
const FETCH_TIMES = 5;
// 初回（通知済みの記録がないとき）の取得回数。ボードの Pin をなるべく全部通知済みにしておく
const INITIAL_FETCH_TIMES = 30;
// 画像つき共有ページ（GitHub Pages）
const SHARE_PAGE = "https://shntrisdr.github.io/Board-to-X-Sync/share.html";

// Pin の識別子。RSS の Pin URL は数字 ID → e1_... のトークンに変わったり、取得のたびに変わったりして当てにならないため、
// 画像ファイル名（https://i.pinimg.com/236x/33/ab/76/<hash>.jpg の <hash>）を使う
const pinKey = (image) => image?.match(/\/([0-9a-f]{32})\.\w+$/)?.[1];

const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]);

export default defineComponent({
  props: {
    db: { type: "data_store", label: "State store", description: "通知済みの Pin URL を保存" },
  },
  async run({ steps, $ }) {
    if (!this.db) throw new Error("State store が未選択です（ステップ上部の State store 欄で Data Store を選択/作成）");
    const seen = await this.db.get("seenImages");

    const parser = new Parser({ headers: { "User-Agent": "Mozilla/5.0" } });
    // 漢字・ハングル入りの URL もそのまま書けるようにエンコード（%xx はそのまま）
    const url = new URL(RSS_URL).href;
    const feeds = [];
    for (let i = 0; i < (seen == null ? INITIAL_FETCH_TIMES : FETCH_TIMES); i++) {
      if (i) await new Promise((r) => setTimeout(r, 500));
      feeds.push(await parser.parseURL(url));
    }

    // RSS の並び順はバラバラなので、日時（Pin を保存した日時）の新しい順に並べる
    const byKey = new Map();
    for (const it of feeds.flatMap((f) => f.items)) {
      const image = it.content?.match(/<img src="([^"]+)"/)?.[1];
      const key = pinKey(image);
      // 画像のない項目は除外（毎回 URL が変わる画像・タイトル・日時なしの項目が RSS に混ざり、毎日通知されていた）
      if (!it.link || !key || byKey.has(key)) continue;
      byKey.set(key, { title: (it.title || "").trim(), link: it.link, image, key, saved: Date.parse(it.isoDate ?? it.pubDate) || 0 });
    }
    const items = [...byKey.values()].sort((a, b) => b.saved - a.saved);

    // まだ通知していない、最近保存した Pin を新着とみなす。初回は最新の 1 件だけ試しに通知する
    const seenSet = new Set(seen ?? []);
    const since = Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const fresh = seen == null ? items.slice(0, 1) : items.filter((it) => !seenSet.has(it.key) && it.saved >= since);

    // 今回 RSS に載っている Pin を全部通知済みにする（新しい順に先頭へ）
    const updated = [...new Set([...items.map((it) => it.key), ...(seen ?? [])])].slice(0, SEEN_LIMIT);
    if (!fresh.length) {
      await this.db.set("seenImages", updated);
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

    await this.db.set("seenImages", updated);
    $.export("$summary", `Notified ${cards.length} Pin(s)`);
    return cards.map(({ link, intent, share }) => ({ link, intent, share }));
  },
});
