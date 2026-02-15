# Contributing

Thank you for considering contributing to **claude-code-proxy**! Here's how you can help.

## Getting Started

1. **Fork** the repository and clone your fork:

   ```bash
   git clone https://github.com/<your-username>/claude-code-proxy.git
   cd claude-code-proxy
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Create a branch** for your change:

   ```bash
   git checkout -b feat/my-feature
   ```

## Development

Run the proxy in watch mode (auto-restarts on file changes):

```bash
cp .env.example .env   # edit as needed
npm run dev
```

Build and type-check:

```bash
npm run build
```

Lint:

```bash
npm run lint
```

## Submitting Changes

1. Make sure the project builds without errors (`npm run build`).
2. Add or update relevant documentation if needed.
3. Commit using clear, descriptive messages.
4. Push your branch and open a **Pull Request** against `main`.

## Reporting Issues

- Use the [GitHub Issues](../../issues) tab.
- Include steps to reproduce, expected behavior, and actual behavior.
- Mention your Node.js version and operating system.

## Code Style

- TypeScript strict mode is enabled.
- Keep functions small and focused.
- Use descriptive variable names.

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
