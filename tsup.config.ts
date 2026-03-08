import { defineConfig } from 'tsup'

export default defineConfig([
  {
    entry: {
      'viem/index': 'src/viem/index.ts',
      'ethers/index': 'src/ethers/index.ts',
      'react/index': 'src/react/index.ts',
    },
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    outDir: 'dist',
    external: ['viem', 'ethers', 'react', 'wagmi', '@tanstack/react-query'],
    treeshake: true,
    tsconfig: 'tsconfig.build.json',
  },
])
