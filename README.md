# StockVision

StockVision is a full-stack stock intelligence app with:

- Multi-ticker charting (candles + line mode)
- Range-based market scans with derived technical metrics
- Live market pulse board
- Market news radar (free public feed, no key)
- SMA strategy backtesting lab
- AI strategy copilot (OpenAI-powered with heuristic fallback)
- Portfolio lab with scenario shock testing

## Project Structure

- `/Users/meetgojiya/Downloads/StockVision/frontend` - Vite + React client
- `/Users/meetgojiya/Downloads/StockVision/backend` - Express API layer

## Environment Variables

### Backend (`/Users/meetgojiya/Downloads/StockVision/backend/.env`)

- `MARKET_DATA_PROVIDER` (optional, defaults to `yahoo-finance`)
- `OPENAI_API_KEY` (optional; enables LLM-generated strategy briefs)
- `OPENAI_MODEL` (optional, defaults to `gpt-4o-mini`)
- `PORT` (optional, defaults to `4000`)

### Frontend (`/Users/meetgojiya/Downloads/StockVision/frontend/.env`)

- `VITE_BACKEND_URL` (defaults to `http://localhost:4000` in this repo)

## Run Locally

1. Backend
   - `cd /Users/meetgojiya/Downloads/StockVision/backend`
   - `npm install`
   - `npm start`
2. Frontend
   - `cd /Users/meetgojiya/Downloads/StockVision/frontend`
   - `npm install`
   - `npm run dev`

Frontend build verification:

- `cd /Users/meetgojiya/Downloads/StockVision/frontend && npm run build`
