export const messageInclude = {
  replyTo: {
    select: {
      id: true,
      sender: true,
      text: true,
      imageUrl: true,
      imageUrls: true,
      createdAt: true,
      editedAt: true,
      recalledAt: true
    }
  },
  reactions: {
    orderBy: {
      createdAt: "asc" as const
    },
    select: {
      id: true,
      sender: true,
      emoji: true,
      createdAt: true
    }
  }
} as const;
