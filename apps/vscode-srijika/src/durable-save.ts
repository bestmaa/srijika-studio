export interface SrijikaSavableDocument {
  save(): Thenable<boolean>;
}

export async function persistSrijikaOwnershipFiles(
  relativePaths: readonly string[],
  openDocument: (relativePath: string) => Thenable<SrijikaSavableDocument>,
): Promise<void> {
  for (const relativePath of relativePaths) {
    const document = await openDocument(relativePath);
    if (!(await document.save())) {
      throw new Error(`VS Code could not persist ${relativePath} to disk.`);
    }
  }
}
