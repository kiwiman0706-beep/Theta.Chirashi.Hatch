# Theta Chirashi Hatch

製薬会社の勉強会・講演会のチラシや、そのほかのイベントのチラシをスマホでスキャンして整理し、Googleカレンダーに登録する Android アプリです。Theta Meishi Hatch と同じつくり（Java＋WebView の共通画面、利用者自身の Gemini APIキーと Google アカウント）です。

## できること

| | |
| --- | --- |
| スキャン | Google のドキュメントスキャナーで撮影（紙の端を見つけて切り抜き・傾き補正）。表面・裏面・会場の地図・一緒にもらった名刺を、まとめて何枚でも。ギャラリーの写真や、他のアプリからの「共有」でも取り込めます |
| QRコード | チラシの QR コード（Zoom・Teams などの参加URL、申込フォーム）をスマホの中で読み取り |
| 読み取り（Gemini） | 会の名前・日時・会場（階・部屋、住所、電話、アクセス）・Web参加（URL・ミーティングID・パスコード）・主催・共催・製品・プログラム（演題、座長・演者・ディスカッサントと所属）・申込・参加費・単位・注意書き（情報交換会など）・資材コード・要約。地図の面は同じ会の会場情報に、名刺は担当者としてまとめます。別々の会のチラシが混ざっていれば分けます |
| Googleカレンダー | 予定のタイトル・場所・時刻に加え、説明欄にチラシの内容を整理したメモ（プログラム、担当者、Web参加情報、自分のメモ、画像へのリンク）。**チラシ画像はGoogleドライブの「Theta Chirashi Hatch」フォルダに保存して予定に添付**します。あとから内容の更新・取り消しも |
| 設定なしでも | 「カレンダーアプリで登録」なら Google Cloud の設定なしで、スマホのカレンダーアプリに内容を入れた状態で開きます（画像の添付はなし） |
| 見る | 一覧（これから／カレンダー未登録／Web参加／過去／すべて、検索）と月のカレンダー表示。詳細画面でチラシ画像の拡大、Zoom を開く、ID・パスコードのコピー、地図・経路、名刺を連絡先に追加、共有、Markdown で保存 |

データ（読み取り結果と画像）はスマホの中に保存されます。

## 入れる

[Releases](https://github.com/kiwiman0706-beep/THETA.Chirashi.Hatch/releases/latest) の `ThetaChirashiHatch-<版>.apk` をスマホでダウンロードして開きます（「提供元不明のアプリ」の許可が必要です）。Android 8.0 以上。

## はじめの設定

1. **Gemini APIキー**：右上の歯車 →「Gemini APIキー」に、Theta Meishi Hatch と同じキー（[Google AI Studio](https://aistudio.google.com/apikey) で作成）を入れて「キーを保存」。
2. **Googleカレンダー（画像付きで登録する場合）**：Meishi Hatch で使っている同じ Google Cloud プロジェクトで、次を行います。アプリの 設定 →「Google連携の初期設定ガイド」に、各画面を開くボタンとコピー用の値があります。
   - **Google Calendar API** と **Google Drive API** を有効にする
   - OAuth 同意画面のテストユーザーに自分の Gmail（Meishi で設定済みなら不要）
   - 「クライアントを作成」→ 種類 **Android**
     - パッケージ名：`jp.yaegaki.theta.chirashi`
     - SHA-1：`75:5E:7B:B7:5D:01:1D:C0:B5:A8:30:CC:CE:48:18:A2:66:D8:3B:66`（このリポジトリの開発用の鍵で署名した APK の場合。アプリの画面にも表示されます）
   - アプリで「Googleにログイン」→ 必要なら「登録先のカレンダーを選ぶ」

求める許可は、カレンダーの予定の作成・変更（`calendar.events`）、カレンダー一覧の参照（`calendar.calendarlist.readonly`）、このアプリが作ったドライブのファイルだけ（`drive.file`）です。

## 使い方

1. 「チラシをスキャン」→ チラシの表・裏・地図・名刺を続けて撮って「完了」
2. QRコードと Gemini の読み取り（20〜60秒）が終わると詳細画面が開くので、内容を確認（違っていれば「編集」）
3. 「Googleカレンダーに登録（画像付き）」または「カレンダーアプリで登録」
4. あとから一覧・カレンダー表示で確認。Web参加の会は詳細画面の「Zoomを開く」から

## リポジトリの中身

| | |
| --- | --- |
| `android/` | Android アプリ。`app/src/main/java/…/MainActivity.java`（スキャナー・QR・Googleアカウント・カレンダー／連絡先アプリ・ファイル）、`app/src/main/assets/www/`（画面：`app.js`、読み取りとカレンダー本文：`core.js`、Gemini・Drive・Calendar API：`google.js`） |
| `test/` | `core.test.js`（読み取り結果→予定の変換、日付、検索）、`ui.e2e.cjs`（画面をブラウザで、Java と Google API の代役つきで操作） |
| `tools/try_gemini.js` | チラシ画像をアプリと同じプロンプトで Gemini に読ませて、結果とカレンダーの説明文を表示（`GEMINI_API_KEY=… node tools/try_gemini.js a.jpg b.jpg`） |
| `.github/workflows/release.yml` | タグ `v*` または手動実行 → テスト → APK → GitHub Release |

## 開発

```bash
cd android && ./gradlew :app:assembleRelease    # app/build/outputs/apk/release/app-release.apk
```

```bash
node --test test/core.test.js
```

```bash
NODE_PATH=$(npm root -g) node test/ui.e2e.cjs
```

署名：リポジトリの Secrets（`ANDROID_KEYSTORE_B64`・`ANDROID_KEYSTORE_PASSWORD`・`ANDROID_KEY_ALIAS`）があればその鍵、無ければ開発用の鍵 `android/signing/chirashi-dev.jks`（パスワード `chirashi-dev`）で署名します。シリーズ共通の鍵に替えると SHA-1 が変わるので、Google Cloud の Android クライアントもその SHA-1 で作り直してください（アプリも入れ直し）。

## まだのこと

- 実機での確認（画面と処理はブラウザの自動テストで確認済み）
- Theta Vault（Google ドライブ上の Markdown フォルダ）との同期、Windows / Mac / Web 版、ホーム画面ウィジェット、アプリ内更新（シリーズ共通仕様のうち未対応のもの）
- 他のシリーズアプリからの Gemini APIキーの引き継ぎ（同じ署名鍵が必要）
