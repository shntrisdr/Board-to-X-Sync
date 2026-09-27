# Board-to-X Sync

自分の Pinterest ボードに新しい Pin を保存すると、毎朝メールで「X に投稿する」リンクが届く個人用の仕組み。
X への投稿は自分でリンクを押して行う（1 タップ）。**運用コストは $0**。

- 公開ページ: https://shntrisdr.github.io/Board-to-X-Sync/
- プライバシーポリシー: https://shntrisdr.github.io/Board-to-X-Sync/privacy-policy.html

## 仕組み

```
Pinterest ボードの RSS ──(1日1回)──> Pipedream ──> メール通知
                                                   ├─ 画像つきで投稿（スマホ）→ share.html → 共有メニュー → X アプリ
                                                   └─ 画像なしで投稿 → X の投稿画面（本文と Pin の URL が入力済み）
```

| ファイル | 役割 |
|---|---|
| `pipedream/rss-notify.mjs` | Pipedream の Node.js ステップ。RSS を読み、未通知の Pin をメールで送る |
| `share.html` | 画像つき共有ページ。Web Share API で画像と本文をスマホの共有メニューに渡す |
| `index.html` / `privacy-policy.html` | 公開ページ（GitHub Pages、`main` のルートから配信） |

- **新着の判定**: 通知済みの Pin の URL を Pipedream の Data Store（キー `seenPins`、最大 300 件）に覚えておき、まだ通知していない Pin を新着とする。RSS の日時は Pin の作成日の可能性があり、保存した日時とずれるので使わない。
- **初回実行**: `seenPins` がないときは RSS の先頭 1 件だけを試しに通知し、RSS に載っている Pin をすべて通知済みにする。
- **画像の取得**: `i.pinimg.com` は CORS ヘッダーを返さないため、`share.html` は [images.weserv.nl](https://images.weserv.nl/) を経由して画像を取得する。RSS のサムネイル（`236x`）は `736x` に差し替えている。

## Pipedream の設定

1. **Workflow**（プロジェクト `hatagaya_yeah`）
   - Trigger: **Schedule**（1 日 1 回、朝）
   - Automatically retry on errors: **OFF**
   - Limit concurrency: **ON（1）**
   - Send error notifications: ON
2. **Node.js ステップ**: `pipedream/rss-notify.mjs` の内容をそのまま貼り付ける
   - 4 行目の `RSS_URL` を自分のボードに書き換える。ボードを開いたときの URL の末尾の `/` を `.rss` に置き換えたもの（例: `https://www.pinterest.com/<ユーザー名>/<ボード名>.rss`）。漢字やハングルが入っていてもそのまま書いてよい
   - 「Refresh fields」を押し、**State store** 欄で Data Store を作成・選択する
3. **Deploy**

メールは Pipedream のアカウントのメールアドレスに届く（`$.send.email`）。

### 動作確認のやり直し

Data Store の `seenPins` を削除して Test を押すと、初回扱いになって RSS の先頭 1 件が届く。

## 既知の制約

- Pinterest の RSS に載るのは最新 25 件程度。1 回の実行の間に 25 件以上保存すると、あふれた分は通知されない。
- 秘密ボードには RSS がない（404 になる）。プロフィールの「ピン」タブ（`/<ユーザー名>/pins/`）もボードではないので使えない。
- 画像つき投稿はスマホ専用（PC のブラウザはファイルの共有にほぼ対応していない）。X アプリが共有された本文を反映するかは OS やアプリのバージョンによる。
- 画像を直接添付すると X に再アップロードすることになる。他人の画像の Pin は著作権に注意。

## なぜこの構成か（経緯）

当初は Pinterest API と X API を使って完全に自動投稿する予定だったが、次の理由で今の構成に変えた（2026/09/27）。

- **X API に無料枠がない**: 2026 年 2 月に新規の無料枠が廃止され、従量課金のみになった。[料金](https://docs.x.com/x-api/getting-started/pricing)は投稿 1 件 $0.015、**URL 付きは $0.200**。
- **Pinterest API のガイドラインで元の Pin へのリンクが必須**: そのため投稿は必ず URL 付きになり、1 日 1 件で月約 $6 かかる。
- **Pinterest API の審査**も不要にしたかった: 公式の RSS を使えば API も審査もいらない。
- **Pipedream の X 連携**はアプリ一覧から消えていた（2026/09 時点）。

X の投稿リンク（`https://x.com/intent/post`）と共有メニューを使えば API は要らないので、無料で済む。
