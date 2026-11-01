export class FooNameTakenError extends Error {
  readonly type = "FooNameTaken";
  readonly fooName: string;
  constructor(fooName: string) {
    super(`A foo named ${fooName} already exists`);
    this.fooName = fooName;
  }
}
export type FooError = FooNameTakenError;
