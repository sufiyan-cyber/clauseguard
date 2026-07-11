import { Workspace } from "@/components/workspace";

export default async function DocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <Workspace documentId={id} />;
}
