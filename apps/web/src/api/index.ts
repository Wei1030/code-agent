/**
 * Backend access for the UI. Currently every call goes to the in-browser mock; the real
 * implementation will call the Node server over REST and WebSocket with the same surface.
 */
import * as mock from '../mock/server';

export const api = mock;
