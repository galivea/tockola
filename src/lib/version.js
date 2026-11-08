/**
 * App version shown in the About box.
 *
 * package.json is the source of truth: tauri.conf.json carries the same string
 * and the release script cross-checks them, so reading it here keeps one file
 * to bump instead of three.
 */
import { version } from "../../package.json";

export const APP_VERSION = version;
