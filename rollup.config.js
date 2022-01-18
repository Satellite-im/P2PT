import dts from "rollup-plugin-dts";
import esbuild from "rollup-plugin-esbuild";

const browserBundle = (config) => ({
    ...config,
    input: "./p2pt.ts",
});

const nodeBundle = (config) => ({
    ...config,
    input: "./node.ts",
});

export default [
    browserBundle({
        plugins: [esbuild()],
        output: [
            {
                file: "dist/p2pt.js",
                format: "cjs",
                sourcemap: true,
            },
            {
                file: "dist/p2pt.es.js",
                format: "es",
                sourcemap: true,
            },
        ],
    }),
    browserBundle({
        plugins: [dts()],
        output: {
            file: "types/p2pt.d.ts",
            format: "es",
        },
    }),
    nodeBundle({
        plugins: [esbuild()],
        output: [
            {
                file: "dist/p2pt-node.js",
                format: "cjs",
                sourcemap: true,
            },
            {
                file: "dist/p2pt-node.es.js",
                format: "es",
                sourcemap: true,
            },
        ],
    }),
    nodeBundle({
        plugins: [dts()],
        output: {
            file: "types/p2pt-node.d.ts",
            format: "es",
        },
    }),
];
