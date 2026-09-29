// The dependency is deliberately resolved even though this carrier program has
// no runtime dependency on the interfaces. scripts/check-iarc22.mjs reads the
// dependency ABI produced by Leo and compares the claimed implementations.
program iarc22_check.aleo {
    fn marker() {}

    @noupgrade
    constructor() {}
}
