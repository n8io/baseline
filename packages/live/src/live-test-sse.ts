/** What `liveTestSseRead` returns: reads a live stream's text in a test. */
export type LiveTestSseReader = {
	/** Resolves with everything read so far once it contains `text`; throws when the stream ends first. */
	until(text: string): Promise<string>;
	/** Resolves with everything read once the Server ends the response. */
	end(): Promise<string>;
	/** Goes away like a page that closes: the Server stops streaming. */
	cancel(): Promise<void>;
};

/** What `liveTestSseRead` takes. */
export type LiveTestSseReadOptions = {
	/** The stream's response, from `liveStreamCreate` or from `fetch`. */
	response: Response;
};

/** Reads a live stream's response in a test, from liveStreamCreate or from fetch. */
export const liveTestSseRead = ({
	response,
}: LiveTestSseReadOptions): LiveTestSseReader => {
	if (response.body === null)
		throw new TypeError("liveTestSseRead: response has no body");
	const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
	let text = "";
	let done = false;
	const more = async (): Promise<void> => {
		const chunk = await reader.read();
		if (chunk.done) done = true;
		else text += chunk.value;
	};
	return {
		cancel: () => reader.cancel(),
		end: async () => {
			while (!done) await more();
			return text;
		},
		until: async (wanted) => {
			while (!text.includes(wanted)) {
				if (done) throw new Error(`Stream ended without ${wanted}: ${text}`);
				await more();
			}
			return text;
		},
	};
};
