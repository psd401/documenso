import { hash } from '@node-rs/bcrypt';
import type { User } from '@prisma/client';

import { prisma } from '@documenso/prisma';

import { SALT_ROUNDS } from '../../constants/auth';
import { AppError, AppErrorCode } from '../../errors/app-error';
import { ensurePsd401BaselineMembership } from '../directory-sync/psd401-membership';

export interface CreateUserOptions {
  name: string;
  email: string;
  password: string;
  signature?: string | null;
}

export const createUser = async ({ name, email, password, signature }: CreateUserOptions) => {
  const hashedPassword = await hash(password, SALT_ROUNDS);

  const userExists = await prisma.user.findFirst({
    where: {
      email: email.toLowerCase(),
    },
  });

  if (userExists) {
    throw new AppError(AppErrorCode.ALREADY_EXISTS);
  }

  const user = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashedPassword, // Todo: (RR7) Drop password.
        signature,
      },
    });

    return user;
  });

  await onCreateUserHook(user).catch((err) => {
    console.error(err);
  });

  return user;
};

export const onCreateUserHook = async (user: User) => {
  await ensurePsd401BaselineMembership(user.id);

  return user;
};
