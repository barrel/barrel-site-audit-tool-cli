export function EmptyCategoryState({ message }: { message: string }) {
  return (
    <div className="bg-white border border-[#E5E5E5] rounded-lg px-5 py-8 text-center text-sm text-[#6B6B6B]">
      {message}
    </div>
  );
}
