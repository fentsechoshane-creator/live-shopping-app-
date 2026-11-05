import { useParams } from "react-router-dom";
import { BackButton } from "../components/ui";

/** Test mode only: what a courier label looks like. With Bob Go switched on, the real PDF opens instead. */
export function MockLabel() {
  const { ref = "" } = useParams();
  return (
    <div className="screen">
      <BackButton to="/sell/orders" label="Orders" />
      <div className="mock-label" role="img" aria-label={`Test courier label ${ref}`}>
        <b>TEST LABEL, NOT FOR SHIPPING</b>
        <span className="mock-barcode" aria-hidden="true" />
        <span className="mock-ref">{ref}</span>
        <p className="small muted">In test mode no courier is booked. When Bob Go is switched on, this button opens the real label to print.</p>
      </div>
    </div>
  );
}
