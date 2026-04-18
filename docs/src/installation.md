# Installation

## Requirements

- Node.js 22.0.0 or later

## Install globally via npm

```bash
npm install -g conclear
```

## Run without installing

```bash
npx conclear
```

## Build from source

```bash
git clone https://github.com/ItsCodejac/conclear
cd conclear
npm install
npm run build
npm start
```

## Development mode

```bash
npm run dev
```

This starts both the Vite dev server (for the React frontend with hot reload) and the Express backend via `tsx watch`.
