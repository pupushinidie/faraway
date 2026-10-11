import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.js";
import { installArtVars } from "./art.js";
import { applyTheme, readTheme } from "./theme.js";
import "./styles.css";
// 像素风皮肤叠在 styles.css 上面：app-pixel.css 管首页和等候房间，faraway.css 管牌桌和卡面。
// 白天版由 day-theme.ts 接在它们后面生成，theme-day.css 是手调的部分。
import "./app-pixel.css";
import "./fa-pages.css";
import "./faraway.css";
import "./theme-day.css";

applyTheme(readTheme());
installArtVars();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
