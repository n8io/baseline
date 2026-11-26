const loggerLevels = [
	"fatal",
	"error",
	"warn",
	"info",
	"debug",
	"trace",
	"silent",
];

/**
 * Returns `level` when it is one the logger knows, so a typo in a level fails with this
 * Package's message, not the vendor's. Throws a `TypeError` otherwise.
 */
export const loggerLevelAssert = (level: string): string => {
	if (!loggerLevels.includes(level)) {
		throw new TypeError(
			`LOG_LEVEL must be one of ${loggerLevels.join(", ")}, found "${level}"`,
		);
	}
	return level;
};
