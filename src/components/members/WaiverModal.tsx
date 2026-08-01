import React from 'react'

interface WaiverModalProps {
  open: boolean
  /** Show the "I Agree" confirm button (hidden when viewing an existing member's waiver). */
  showAgree: boolean
  onClose: () => void
  onAgree: () => void
}

/** Membership waiver & release — shared by the new-member and renewal flows (P2 6.6). */
function WaiverModal({ open, showAgree, onClose, onAgree }: WaiverModalProps) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal waiver-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="display-text">📄 Membership Waiver & Release</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body waiver-modal-body">
          <div className="waiver-content">
            <h3>ASSUMPTION OF RISK AND RELEASE OF LIABILITY</h3>

            <p>I, the undersigned, acknowledge that I am voluntarily participating in the programs and activities offered by this fitness facility. I understand that there are inherent risks involved in physical exercise and the use of fitness equipment and facilities.</p>

            <h4>1. ASSUMPTION OF RISK</h4>
            <p>I acknowledge that I have been informed of the potential risks associated with my participation, including but not limited to: muscle strains, sprains, fractures, cardiovascular complications, and other physical injuries. I voluntarily assume all risks associated with my participation.</p>

            <h4>2. MEDICAL CLEARANCE</h4>
            <p>I represent that I am in good physical health and have no medical condition that would prevent safe participation in exercise programs. I understand that it is my responsibility to consult with a physician prior to beginning any exercise program.</p>

            <h4>3. RELEASE OF LIABILITY</h4>
            <p>I hereby release, waive, and discharge this facility, its owners, employees, and agents from any and all liability, claims, demands, actions, or causes of action arising out of or related to any loss, damage, or injury, including death, that may be sustained by me while participating in any activities at this facility.</p>

            <h4>4. USE OF FACILITIES</h4>
            <p>I agree to use all equipment and facilities in a safe and responsible manner. I understand that I must follow all posted rules and staff instructions. I will report any damaged or unsafe equipment to staff immediately.</p>

            <h4>5. PHOTOGRAPHY AND MARKETING</h4>
            <p>I grant permission to the facility to use photographs, video, or other media of me for promotional and marketing purposes, unless I notify the facility in writing of my objection.</p>

            <hr />

            <p className="waiver-agreement-text">
              By clicking "I Agree", I confirm that I have read, understood, and voluntarily agree to the terms and conditions of this waiver and release of liability.
            </p>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          {showAgree && (
            <button className="btn btn-primary" onClick={onAgree}>
              I Agree
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default WaiverModal
