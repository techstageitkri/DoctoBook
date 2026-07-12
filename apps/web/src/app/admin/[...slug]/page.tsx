import { AdminRoutePage } from "../admin-route-page";
export default async function Page({ params }: { params: Promise<{ slug: string[] }> }) { const { slug } = await params; return <AdminRoutePage route={slug.join("/")} />; }
