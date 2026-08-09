const DEFAULT_UNKNOWN_SCREEN_THRESHOLD = 12;

class DomRecognitionGuard {
    constructor({ threshold = DEFAULT_UNKNOWN_SCREEN_THRESHOLD } = {}) {
        this.threshold = threshold;
        this.wasConnected = false;
        this.unknownCycles = 0;
        this.alertSent = false;
    }

    observe(status) {
        if (status === 'connected') {
            this.wasConnected = true;
            this.unknownCycles = 0;
            this.alertSent = false;
            return false;
        }

        if (status === 'qr_required') {
            this.wasConnected = false;
            this.unknownCycles = 0;
            return false;
        }

        if (status !== 'starting' || !this.wasConnected) {
            this.unknownCycles = 0;
            return false;
        }

        this.unknownCycles += 1;
        if (this.unknownCycles < this.threshold || this.alertSent) return false;
        this.alertSent = true;
        return true;
    }
}

module.exports = { DEFAULT_UNKNOWN_SCREEN_THRESHOLD, DomRecognitionGuard };
