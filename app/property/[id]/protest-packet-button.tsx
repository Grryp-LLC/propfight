"use client";

export default function ProtestPacketButton({
  propertyId,
  address,
}: {
  propertyId: string;
  address: string;
}) {
  function handleDownload() {
    window.open(
      `/api/property/${propertyId}/protest-packet`,
      "_blank"
    );
  }

  return (
    <button
      onClick={handleDownload}
      className="px-4 py-2 bg-[#1a56db] text-white text-sm font-medium rounded-lg hover:bg-[#1544b8] transition-colors"
      title={`Download protest packet for ${address}`}
    >
      Download Protest Packet
    </button>
  );
}
