# Contributing to Pero Editor

Thank you for your interest in contributing!

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/your-username/pero-editor`
3. Set up the development environment (see [README.md](./README.md))
4. Create a branch: `git checkout -b feat/your-feature`

## Development Workflow

### Backend (`app-backend/`)

```bash
npm run dev      # Start dev server with hot reload
npm test         # Run tests
npm run build    # Compile TypeScript
```

### Frontend (`app-frontend/`)

```bash
npm run dev      # Vite dev server on port 3000
npm run lint     # TypeScript type check
npm run build    # Production build
```

### Desktop (`app-desktop/`)

```bash
npm run dev      # Electron + Vite dev mode
npm run dist     # Build DMG
```

## Submitting Changes

- Keep pull requests focused on a single change
- Add tests for new backend functionality where applicable
- Make sure `npm test` passes in `app-backend/`
- Describe what and why in the PR description

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md) when opening an issue.

## Requesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

## Code Style

- TypeScript strict mode throughout
- Follow the patterns in existing files
- No `any` types unless strictly necessary

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
