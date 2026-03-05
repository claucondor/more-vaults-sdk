import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      'viem/index': 'src/viem/index.ts',
      'ethers/index': 'src/ethers/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: ['viem', 'ethers'],
    treeshake: true,
    tsconfig: 'tsconfig.build.json',
  },
])
