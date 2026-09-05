import { currentUser } from '../../lib/auth.mjs';
import { getBoard } from '../board.mjs';
import { CUSTOM_TARGET_MAX, CUSTOM_TARGET_MIN } from '../score.mjs';
import { errorResponse, HttpError, json } from '../../lib/http.mjs';

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get('mode') === 'custom' ? 'custom' : 'daily';
    const timeframe = url.searchParams.get('timeframe') === 'all' ? 'all' : 'today';
    const includeReplay = url.searchParams.get('replay') !== '0';
    let target = null;
    if (mode === 'custom') {
      target = Number(url.searchParams.get('target'));
      if (!Number.isInteger(target) || target < CUSTOM_TARGET_MIN || target > CUSTOM_TARGET_MAX) {
        throw new HttpError(400, 'BAD_TARGET', '目标秒数不合法');
      }
    }
    const user = await currentUser(request);
    const board = await getBoard({ mode, target, timeframe, includeReplay, currentUserId: user?.id || null });
    return json(board);
  } catch (error) {
    return errorResponse(error);
  }
}
