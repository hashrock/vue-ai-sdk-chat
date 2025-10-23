# Minimal chat app

- Vue 3 + TypeScript + Vite
- Vercel AI SDK v5
- Hono (Backend API Server)

## 機能

### チャット UI
- 標準的なチャット UI
- マークダウン表示、コードハイライト
- Tool 使用履歴を pill で表示
- メッセージ履歴は永続化しない（セッション内のみ）

### ファイル操作 (Tool use)
- `.env` で指定した `LOCAL_PATH` 配下のファイルを読み書き可能
- 対応する操作:
  - ファイル読み込み (`read_file`)
  - ファイル書き込み (`write_file`)
  - ファイル一覧取得 (`list_files`)
  - その他の操作（削除、リネーム、ディレクトリ作成）
- セキュリティ: `LOCAL_PATH` 外へのアクセスは禁止

## 構成

### フロントエンド
- Vue 3 + TypeScript + Vite
- Vercel AI SDK v5 (`ai/vue`)

### バックエンド
- Hono (別サーバーとして起動)
- Vercel AI SDK v5 対応エンドポイント
- Tool 定義とファイル操作の実装

## セットアップ

```bash
# .env ファイルを作成
cp .env.example .env

# 環境変数を設定
# LOCAL_PATH=/path/to/your/workspace
# OPENAI_API_KEY=your-api-key
```

## 開発

```bash
# 依存関係のインストール
npm install

# フロントエンド起動
npm run dev

# バックエンド起動（別ターミナル）
npm run server
```
