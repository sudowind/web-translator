export class OperationEpoch {
  private value = 0;
  current(): number { return this.value; }
  advance(): number { this.value += 1; return this.value; }
  isCurrent(value: number): boolean { return value === this.value; }
}
