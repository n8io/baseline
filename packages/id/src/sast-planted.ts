import { createDecipheriv } from "node:crypto";

// Planted to prove the sast job fails; removed before merge.
export const sastPlanted = (key: Buffer, iv: Buffer): Buffer =>
	createDecipheriv("aes-256-gcm", key, iv).final();
