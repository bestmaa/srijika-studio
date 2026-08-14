# CLI and fast runtime

## Shared command surface

```text
srijika init <directory>
srijika add <feature|slot|part|hook|store|logic|api|types>
srijika check
srijika doctor
srijika install
srijika dev [--runtime node|bun]
srijika build
srijika studio
```

Use `srijika add --dry-run` before a write when exact targets or safe rewires
need review. Never replace it with arbitrary `mkdir` or template writes. New
owners always include UI + Connector and accept only the optional Hook, Store,
Logic, API, and Types set.

## Runtime decision

Node is the default compatibility runtime. Bun is optional and explicit:

```bash
srijika dev --runtime bun
```

Select Bun only for a detected Vite project. If Bun is unavailable or the
project is incompatible, retain the reported Node fallback. Do not install Bun,
rewrite package scripts, replace a lockfile, or change the package manager
without explicit user authorization.

Runtime selection and dependency resolution are separate. `srijika install`
must follow the declared package manager and detected lockfile. React runs in
the browser in either mode.

## App lifecycle

`srijika dev` and VS Code **Run App** start the real Vite HMR process. Do not
claim full application behavior from the derived UI renderer. `srijika studio`
passes the validated root through `--project`; Desktop then opens it through its
bounded native project service.

Run `srijika doctor` before diagnosing a startup failure and `srijika check`
after architecture changes. Treat any error diagnostic as a failed check;
recommendations remain non-blocking.
