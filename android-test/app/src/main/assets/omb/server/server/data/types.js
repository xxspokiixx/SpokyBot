export class DataFailure extends Error {
    error;
    constructor(error) {
        super(error.message);
        this.name = "DataFailure";
        this.error = error;
    }
}
