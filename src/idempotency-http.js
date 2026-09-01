import {
  claimIdempotencyKey,
  failIdempotentMutation,
  finishIdempotentMutation
} from './idempotency-ledger.js';
import { AppError, stableErrorCode } from './errors.js';

export async function runIdempotentMutation(req, { route, body = null, successStatus = 200, execute }) {
  const key = req.headers?.['idempotency-key'];
  const claim = await claimIdempotencyKey(key, { route, body });
  if (claim.invalid) throw new AppError('INVALID_REQUEST');
  if (claim.conflict || claim.inProgress) throw new AppError('CONFLICT');
  if (claim.replayed) {
    return { replayed: true, operationId: claim.operationId, status: claim.responseStatus, body: claim.responseBody };
  }

  let effectCompleted = false;
  try {
    const responseBody = await execute();
    effectCompleted = true;
    await finishIdempotentMutation(key, {
      route, operationId: claim.operationId, responseStatus: successStatus, responseBody
    });
    return { replayed: false, operationId: claim.operationId, status: successStatus, body: responseBody };
  } catch (error) {
    // A completion-write failure leaves the claim IN_PROGRESS. Retrying cannot duplicate
    // an effect whose durable replay receipt is ambiguous.
    if (!effectCompleted) {
      await failIdempotentMutation(key, {
        route, operationId: claim.operationId, errorCode: stableErrorCode(error)
      });
    }
    throw error;
  }
}

export function sendIdempotentResult(res, result, send) {
  res.setHeader('x-idempotent-replay', String(result.replayed));
  res.setHeader('idempotency-operation-id', result.operationId);
  return send(res, result.status, result.body);
}
