async raffle(id: number, adminId: string) {
    const round = await this.repo.findOne({ //DB에서 라운드 불러오기
      select: { // 하단에 적힌 항목만 불러오기
        id: true, // 라운드 ID
        awards: true, // 라운드 경품
        endDatetime: true, // 라운드 만료일
        maxRecruitsCount: true, // 라운드 모집원인원
        status: true, // 라운드 상태
        defaultProduct: { // 라운드 기본 상품
          id: true, // 의 ID
        },
      },
      where: { id }, // 라운드 ID를 통해 데이터 검색
      relations: ['defaultProduct'], // 기본 상품 불러오기
    });

    if (!round) {
      throw new NotFoundException(); // 라운드가 없을시 오류 반환
    }

    const [roundJoinCount] = await Promise.all([ // 해당 [] 안에 있는 모든 항목이 완료되야 다음 명령을 실행
      this.roundJoinLogsService.repo // 라운드 참가기록 불러오기
        .createQueryBuilder('rj') // 해당 데이터를 rj로 선언
        .select('SUM(rj.buyTicketCount) as buyTicketCount') //구매한 티켓 합계 계산
        .where('rj.round = :roundId', { // 라운드에 일치하는 참가 기록 검색
          roundId: round.id,
        })
        .getRawOne(), // 상단에 적힌 조건 실행 및 불러오기
    ]);

    const roundTicketCount = Number(roundJoinCount?.buyTicketCount); // 총 구매 티켓 수를 숫자 타입으로 확정

    if ( // 만약에
      round.endDatetime > new Date() && // 지금 시간이 라운드 만료 시간을 지나지 않았고
      round.maxRecruitsCount > roundTicketCount // 참여자 수가 모집인원보다 작을때 실행
    ) {
      throw new BadRequestException('라운드가 종료되지 않았습니다.'); // 오류 반환
    }

    if (round.status !== '심사') { // 라운드가 심사상태가 아닐때 실행
      throw new BadRequestException('라운드 상태가 심사가 아닙니다.'); // 오류 반환
    }

    const { awards } = round; // 라운드의 award(경품) 데이터만 award에 저장

    const joinLogs = await this.roundJoinLogsService.repo.find({ // 참가기록 불러오기
      select: { // 하단에 적힌 항목만 불러오기
        buyTicketCount: true, // 티켓 구매 수
        user: { // 유저
          id: true, // 유저 고유 ID
        },
      },
      relations: ['user', 'round'], // 유저, 라운드 불러오기
      where: { // 검색
        round: { id }, // ID와 일치하는 라운드
      },
    });

    let joinUserIds: string[] = joinLogs
      .map((item) => { // item 선언문에 있는 항목을 하나씩 불러오기
        return Array(item.buyTicketCount).fill(item.user.id); // 불러온 데이터로 새로운 배열을 생성 및 구매한 티켓 수 만큼 유저 ID채우기
      })
      .flat(); // 하나의 배열로 통합

    const awardLogsDraft = awards
      .map((award) => { // 경품 선정
        const winUserIds = getUniqueRandomItems( // 당첨자 선정(random.ts에서 불러와서 실행)
          joinUserIds, // 참여자 ID들
          award.allowedCount, // 경품 당첨 수
        );

        return winUserIds.map((userId) => ({ // 선정된 당첨자 내용을 하나씩 불러오기
          award, // 경품
          round: { id }, // 라운드 ID
          user: { id: userId }, // 유저 Id
          admin: { id: adminId }, // 라운드 추첨한 관리자 ID
        }));
      })
      .flat(); // 하나의 배열로 통합

    await this.roundAwardLogsService.repo // 당첨자 항목에 저장
      .createQueryBuilder()
      .insert()
      .values(awardLogsDraft)
      .execute(); // 명령어 실행

    await this.repo.update(id, { // 라운드 업데이트
      status: '종료', // 라운드 종료 선언
      raffleDatetime: new Date(), // 라운드 추첨일자 등록
    });

    return 'ok'; // 완료
  }
