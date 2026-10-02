import type { BunPlugin } from "bun";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/** Retain the project's Tailwind 3/PostCSS pipeline in Bun's HTML bundler. */
const tailwind: BunPlugin = {
  name: "flaregit-tailwind3",
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async ({ path }) => {
      const result = await postcss([tailwindcss(), autoprefixer()]).process(await Bun.file(path).text(), { from: path, map: false });
      return { contents: result.css, loader: "css" };
    });
  },
};
export default tailwind;
