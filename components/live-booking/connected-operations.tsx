"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { liveAction } from "@/lib/live-booking/client";
export type OperationState = {
  canCancel: boolean;
  canReschedule: false;
  mutationState: string | null;
};
export function ConnectedOperationPanel({
  state,
  review,
  pending,
  message,
  onReview,
  onCancel,
  onReconcile,
  onBack,
  summary,
}: {
  state: OperationState;
  review: boolean;
  pending: boolean;
  message: string;
  onReview: () => void;
  onCancel: () => void;
  onReconcile: () => void;
  onBack: () => void;
  summary: string;
}) {
  const unresolved = !!state.mutationState;
  return (
    <section className="business-panel business-form">
      <h3>Connected through ezyVet</h3>
      <p>{summary}</p>
      {unresolved ? (
        <>
          <h4>Provider confirmation pending</h4>
          <p>
            We couldn’t confirm whether the provider completed the cancellation.
            Check the provider’s current status before trying another change.
          </p>
          <button
            className="button secondary"
            disabled={pending}
            onClick={onReconcile}
          >
            {pending ? "Checking provider status…" : "Check provider status"}
          </button>
        </>
      ) : review ? (
        <>
          <h4>Cancel this appointment?</h4>
          <p>
            PetThread will ask the provider’s scheduling system to cancel this
            appointment. Nothing changes until the provider confirms the update.
          </p>
          <div className="provider-actions">
            <button className="button" disabled={pending} onClick={onCancel}>
              {pending ? "Confirming cancellation…" : "Confirm cancellation"}
            </button>
            <button
              className="button secondary"
              disabled={pending}
              onClick={onBack}
            >
              Keep appointment
            </button>
          </div>
        </>
      ) : state.canCancel ? (
        <button
          className="button secondary"
          disabled={pending}
          onClick={onReview}
        >
          Cancel appointment
        </button>
      ) : (
        <p>Contact the provider to cancel or change this appointment.</p>
      )}
      <p className="fine-print">
        Connected rescheduling is unavailable. Contact the provider to change
        the time.
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
export function ConnectedOperations({
  appointmentId,
  summary,
  autoLoad = true,
  initialState,
}: {
  appointmentId: string;
  summary: string;
  autoLoad?: boolean;
  initialState?: OperationState;
}) {
  const router = useRouter(),
    [state, setState] = useState<OperationState>(
      initialState || {
        canCancel: false,
        canReschedule: false,
        mutationState: null,
      },
    ),
    [pending, setPending] = useState(false),
    [review, setReview] = useState(false),
    [message, setMessage] = useState(""),
    [loaded, setLoaded] = useState(autoLoad || !!initialState?.mutationState);
  async function check() {
    setPending(true);
    setLoaded(true);
    try {
      setState(
        await liveAction<OperationState>({
          action: "appointment_operations",
          appointmentId,
        }),
      );
    } catch {
      setState((previous) => ({ ...previous, canCancel: false }));
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    if (!autoLoad) return;
    let current = true;
    liveAction<OperationState>({
      action: "appointment_operations",
      appointmentId,
    })
      .then((r) => {
        if (current) setState(r);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [appointmentId, autoLoad]);
  async function mutate(
    action: "cancel_appointment" | "reconcile_appointment",
  ) {
    if (pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await liveAction<{ state: string; cancelled?: boolean }>({
        action,
        appointmentId,
      });
      if (result.cancelled) {
        setState({
          canCancel: false,
          canReschedule: false,
          mutationState: null,
        });
        setReview(false);
        setMessage("Appointment cancelled. The provider confirmed the change.");
        router.refresh();
      } else if (result.state === "reconciled") {
        setState({
          canCancel: false,
          canReschedule: false,
          mutationState: null,
        });
        setReview(false);
        setMessage("The provider still shows the appointment as active.");
        router.refresh();
      } else {
        setState({
          canCancel: false,
          canReschedule: false,
          mutationState: "unknown",
        });
        setReview(false);
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (
        [
          "unauthorized",
          "unsupported",
          "unavailable",
          "conflict",
          "rate_limited",
          "vendor_error",
        ].includes(code)
      ) {
        setReview(false);
        setState({
          canCancel: false,
          canReschedule: false,
          mutationState: null,
        });
        setMessage(
          code === "conflict"
            ? "The appointment changed. Refresh its details before trying again."
            : "The change could not be confirmed. Contact the provider.",
        );
      } else {
        setState({
          canCancel: false,
          canReschedule: false,
          mutationState: "unknown",
        });
        setReview(false);
      }
    } finally {
      setPending(false);
    }
  }
  if (!loaded)
    return (
      <button className="button secondary" onClick={check}>
        Check connected options
      </button>
    );
  return (
    <ConnectedOperationPanel
      state={state}
      review={review}
      pending={pending}
      message={message}
      onReview={() => setReview(true)}
      onCancel={() => mutate("cancel_appointment")}
      onReconcile={() => mutate("reconcile_appointment")}
      onBack={() => setReview(false)}
      summary={summary}
    />
  );
}
